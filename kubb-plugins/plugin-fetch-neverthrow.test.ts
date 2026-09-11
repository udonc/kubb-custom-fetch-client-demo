import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { pluginFetch } from "@kubb/plugin-fetch";
import { pluginTs } from "@kubb/plugin-ts";
import { createKubb, defineConfig } from "kubb";
import { pluginFetchNeverthrow } from "./plugin-fetch-neverthrow.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");

/**
 * 生成物は `neverthrow` を import するので、モジュール解決が効くように
 * プロジェクト配下（git 管理外の node_modules/.cache）へ出力する
 */
const createOutputDir = async (): Promise<string> => {
  const cacheDir = path.join(projectRoot, "node_modules/.cache");
  await mkdir(cacheDir, { recursive: true });
  return mkdtemp(path.join(cacheDir, "plugin-fetch-neverthrow-"));
};

const generate = async (outputPath: string) => {
  const kubb = createKubb(
    defineConfig({
      root: projectRoot,
      input: "./openapi.yaml",
      output: { path: outputPath, clean: true },
      plugins: [
        pluginTs(),
        pluginFetch({ baseURL: "https://api.example.com/v1" }),
        pluginFetchNeverthrow(),
      ],
    }),
  );
  return kubb.generate();
};

/** 生成された TypeScript が `tsc --noEmit` を通ることを確認する */
const typecheck = (files: ReadonlyArray<string>): void => {
  const tsc = path.join(projectRoot, "node_modules/.bin/tsc");
  const flags = [
    // ファイルを直接指定するときは tsconfig.json を読まない（TS 7 では明示が必要）
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--target",
    "esnext",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--skipLibCheck",
  ];
  execFileSync(tsc, [...flags, ...files], {
    cwd: projectRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
};

describe("pluginFetchNeverthrow", () => {
  let out: string;
  let runtime: string;
  let getBook: string;

  before(async () => {
    out = await createOutputDir();
    const result = await generate(out);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.deepEqual(errors, []);
    assert.equal(result.success, true);

    runtime = await readFile(path.join(out, ".kubb/neverthrow.ts"), "utf8");
    getBook = await readFile(
      path.join(out, "fetch-neverthrow/getBook.ts"),
      "utf8",
    );
  });

  after(async () => {
    await rm(out, { recursive: true, force: true });
  });

  describe("共通部（.kubb/neverthrow.ts）", () => {
    it("Kubb client の型を隣の client.ts から import する", () => {
      assert.match(runtime, /from ['"]\.\/client['"]/);
    });

    it("toResultAsync と Result 型群を export する", () => {
      assert.match(runtime, /export const toResultAsync = /);
      assert.match(runtime, /export type RequestError<TResponses> =/);
      assert.match(runtime, /export type Options<TData extends DataShape> =/);
      assert.match(runtime, /export type TransportError =/);
      assert.match(runtime, /export type HttpError<TResponses> =/);
      assert.match(runtime, /export type UnexpectedResponseError =/);
    });
  });

  describe("operation ごとの生成物（fetch-neverthrow/getBook.ts）", () => {
    it("必要な import が揃っている", () => {
      assert.match(
        getBook,
        /import type \{ ResultAsync \} from ['"]neverthrow['"]/,
      );
      assert.match(
        getBook,
        /import \{ client \} from ['"]\.\.\/\.kubb\/client['"]/,
      );
      assert.match(
        getBook,
        /import \{ toResultAsync \} from ['"]\.\.\/\.kubb\/neverthrow['"]/,
      );
      assert.match(
        getBook,
        /import type \{ Options, RequestError \} from ['"]\.\.\/\.kubb\/neverthrow['"]/,
      );
      assert.match(
        getBook,
        /import type \{ GetBookOptions, GetBookResponses \} from ['"]\.\.\/types\/GetBook['"]/,
      );
      assert.match(
        getBook,
        /import type \{ Book \} from ['"]\.\.\/types\/Book['"]/,
      );
    });

    it("operation 固有の Error 型を export する", () => {
      assert.match(
        getBook,
        /export type GetBookError = RequestError<GetBookResponses>;/,
      );
    });

    it("dummy と同じ形の関数を生成する", () => {
      const expected = `/**
 * @summary 書籍を 1 件取得する
 * {@link /books/:isbn}
 */
export function getBook(
  options: Options<GetBookOptions>,
): ResultAsync<Book, GetBookError> {
  const { client: request = client, ...config } = options;

  return toResultAsync<GetBookResponses>(
    request({
      ...config,
      method: "GET",
      url: "/books/{isbn}",
      throwOnError: false,
    }),
    [200, 404],
  );
}`;
      assert.ok(
        getBook.includes(expected),
        `expected function body not found in:\n${getBook}`,
      );
    });

    it("barrel（index.ts）から getBook を export する", async () => {
      const index = await readFile(
        path.join(out, "fetch-neverthrow/index.ts"),
        "utf8",
      );
      assert.match(index, /export \{ getBook \} from ['"]\.\/getBook['"]/);
    });
  });

  describe("生成物の型", () => {
    it("tsc --noEmit を通り、呼び出し側で期待する型に絞られる", async () => {
      const usage = `
import type { ResultAsync } from "neverthrow";
import { getBook, type GetBookError } from "./fetch-neverthrow";
import type { ApiError } from "./types/ApiError";
import type { Book } from "./types/Book";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// 戻り値は ResultAsync<Book, GetBookError>
const result: ResultAsync<Book, GetBookError> = getBook({ path: { isbn: "4299039009" } });
void result;

// path.isbn は必須
// @ts-expect-error
getBook({});

// throwOnError は呼び出し側から渡せない
// @ts-expect-error
getBook({ path: { isbn: "x" }, throwOnError: true });

// http エラーは OpenAPI に書かれた 404 / ApiError に絞られる
type Http = Extract<GetBookError, { kind: "http" }>;
const status: Equal<Http["status"], 404> = true;
const body: Equal<Http["body"], ApiError> = true;
void status;
void body;

// transport / unexpected も残っている
const kinds: Equal<GetBookError["kind"], "transport" | "http" | "unexpected"> = true;
void kinds;
`;
      const usagePath = path.join(out, "usage.ts");
      await writeFile(usagePath, usage);

      try {
        typecheck([usagePath]);
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout ?? String(error);
        assert.fail(`tsc failed:\n${stdout}`);
      }
    });
  });
});
