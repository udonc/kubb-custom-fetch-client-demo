import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginFetchName } from "@kubb/plugin-fetch";
import type { ResolverTs } from "@kubb/plugin-ts";
import { pluginTsName } from "@kubb/plugin-ts";
import type { Group, Output, PluginFactoryOptions } from "kubb/kit";
import { ast, defineGenerator, definePlugin, Url } from "kubb/kit";

type Options = {
  /**
   * @default { path: "fetch-neverthrow", barrel: { type: "named" } }
   */
  output?: Output;
};

type ResolvedOptions = {
  output: Output;
};

export type PluginFetchNeverthrow = PluginFactoryOptions<
  "plugin-fetch-neverthrow",
  Options,
  ResolvedOptions
>;

export const pluginFetchNeverthrowName =
  "plugin-fetch-neverthrow" satisfies PluginFetchNeverthrow["name"];

// --- 共通ランタイム（`.kubb/neverthrow.ts`） ---

/** 共通ランタイムのファイル名 */
const RUNTIME_BASENAME = "neverthrow.ts";

/** 出力ルート配下の `.kubb/` にあるランタイムファイルの絶対パスを解決する。 */
const resolveRuntimePaths = (root: string) => ({
  client: path.resolve(root, ".kubb/client.ts"),
  // plugin-fetch が作成する `client.ts` と同じ位置に neverthrow のランタイムを配置する
  neverthrow: path.resolve(root, ".kubb", RUNTIME_BASENAME),
});

/** 共通ランタイムを `.kubb/` に配置するファイルノードを作る */
const createRuntimeFile = (root: string): ast.UserFileNode => ({
  baseName: RUNTIME_BASENAME,
  path: resolveRuntimePaths(root).neverthrow,
  // plugin-fetch と同じくテンプレートをそのままコピーする。出力先で隣の client.ts を import する都合上、
  // コピー元のファイルの拡張子を .ts.txt にして型チェックとエディタの診断から外している
  copy: fileURLToPath(
    new URL("./templates/neverthrow.ts.txt", import.meta.url),
  ),
});

// --- operation ごとの生成 ---

type OperationNames = {
  /** 生成する関数名（例: getBook） */
  fn: string;
  /** plugin-ts が生成する options 型（例: GetBookOptions） */
  options: string;
  /** plugin-ts が生成する responses 型（例: GetBookResponses） */
  responses: string;
  /** この plugin が生成する error 型（例: GetBookError） */
  error: string;
};

type SuccessType = {
  /** 成功時のデータ型の式（例: Book） */
  expression: string;
  /** 式が参照する型の import */
  imports: Array<ast.ImportNode>;
};

const isSuccessStatusCode = (statusCode: ast.StatusCode): boolean => {
  const code = Number(statusCode);
  return code >= 200 && code < 300;
};

/**
 * 成功レスポンスのデータ型を解決する。
 * `$ref` なら参照先のスキーマ型（例: `Book`）を直接使い、inline スキーマなら
 * plugin-ts が operation ファイルに書き出す `<Op>Status<code>` を使う。
 */
const resolveSuccessType = (params: {
  node: ast.HttpOperationNode;
  tsResolver: ResolverTs;
  typesFile: ast.FileNode;
  root: string;
  output: Output;
  group: Group | undefined;
}): SuccessType => {
  const { node, tsResolver, typesFile, root, output, group } = params;

  const members = node.responses
    .filter((response) => isSuccessStatusCode(response.statusCode))
    .map((response): SuccessType => {
      const schema = response.content?.[0]?.schema;
      const refName = ast.resolveRefName(schema);
      if (schema && refName) {
        return {
          expression: tsResolver.name(refName),
          imports: tsResolver.imports({ node: schema, root, output, group }),
        };
      }
      const name = tsResolver.response.status(node, response.statusCode);
      return {
        expression: name,
        imports: [
          ast.factory.createImport({ name: [name], path: typesFile.path }),
        ],
      };
    });

  if (members.length === 0) {
    return { expression: "never", imports: [] };
  }
  return {
    expression: [...new Set(members.map((m) => m.expression))].join(" | "),
    imports: members.flatMap((m) => m.imports),
  };
};

/** OpenAPI に書かれている status の一覧。`default` は数値にできないので含めない */
const resolveDocumentedStatuses = (
  node: ast.HttpOperationNode,
): Array<number> =>
  node.responses
    .map((response) => Number(response.statusCode))
    .filter((status) => Number.isInteger(status));

/** 必須の入力が何も無ければ options 引数を省略可能にする */
const isOptionsOptional = (node: ast.HttpOperationNode): boolean => {
  const hasRequiredParameter = node.parameters.some(
    (parameter) => parameter.required && parameter.in !== "cookie",
  );
  const hasBody = Boolean(node.requestBody?.content?.[0]?.schema);
  return !hasRequiredParameter && !hasBody;
};

const renderJsDoc = (node: ast.HttpOperationNode): string => {
  const lines = [
    node.description && `@description ${node.description}`,
    node.summary && `@summary ${node.summary}`,
    node.deprecated && "@deprecated",
    `{@link ${Url.toPath(node.path)}}`,
  ].filter((line): line is string => Boolean(line));
  return `/**\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\n`;
};

const renderOperationFunction = (params: {
  node: ast.HttpOperationNode;
  names: OperationNames;
  success: SuccessType;
}): string => {
  const { node, names, success } = params;
  const optionsDefault = isOptionsOptional(node) ? " = {}" : "";
  const documented = resolveDocumentedStatuses(node).join(", ");

  return `${renderJsDoc(node)}export function ${names.fn}(
  options: Options<${names.options}>${optionsDefault},
): ResultAsync<${success.expression}, ${names.error}> {
  const { client: request = client, ...config } = options;

  return toResultAsync<${names.responses}>(
    request({
      ...config,
      method: "${node.method}",
      url: "${node.path}",
      throwOnError: false,
    }),
    [${documented}],
  );
}
`;
};

const operationFileEntry = (node: ast.HttpOperationNode) => ({
  name: node.operationId,
  extname: ".ts" as const,
  tag: node.tags[0] ?? "default",
  path: node.path,
});

const clientGenerator = defineGenerator<PluginFetchNeverthrow>({
  name: "fetch-neverthrow",
  operation(node, ctx) {
    if (!ast.isHttpOperationNode(node)) return null;

    const pluginTs = ctx.getPlugin(pluginTsName);
    if (!pluginTs?.options?.output) {
      ctx.warn(
        "Skipped: `pluginTs()` を plugins に追加してください。operation の Options / Responses 型を plugin-ts の生成物から import します。",
      );
      return null;
    }
    if (!ctx.getPlugin(pluginFetchName)) {
      ctx.warn(
        "Skipped: `pluginFetch()` を plugins に追加してください。生成物は plugin-fetch の `.kubb/client.ts` を呼び出します。",
      );
      return null;
    }

    const { root, resolver, config } = ctx;
    const { output } = ctx.options;
    const tsResolver = ctx.getResolver(pluginTsName);
    const tsOutput = pluginTs.options.output;
    const tsGroup = pluginTs.options.group ?? undefined;
    const runtime = resolveRuntimePaths(root);

    const file = resolver.file({ ...operationFileEntry(node), root, output });
    const typesFile = tsResolver.file({
      ...operationFileEntry(node),
      root,
      output: tsOutput,
      group: tsGroup,
    });

    const names: OperationNames = {
      fn: resolver.name(node.operationId),
      options: tsResolver.response.options(node),
      responses: tsResolver.response.responses(node),
      // 型名なので plugin-ts の命名規則（PascalCase）に合わせる
      error: tsResolver.name(`${node.operationId} Error`),
    };
    const success = resolveSuccessType({
      node,
      tsResolver,
      typesFile,
      root,
      output: tsOutput,
      group: tsGroup,
    });

    const bannerContext = {
      output,
      config,
      file: { path: file.path, baseName: file.baseName },
    };

    return [
      ast.factory.createFile({
        baseName: file.baseName,
        path: file.path,
        meta: file.meta,
        banner: resolver.default.banner(ctx.meta, bannerContext),
        footer: resolver.default.footer(ctx.meta, bannerContext),
        imports: [
          ast.factory.createImport({
            name: ["ResultAsync"],
            path: "neverthrow",
            isTypeOnly: true,
          }),
          ast.factory.createImport({
            name: ["client"],
            path: runtime.client,
            root: file.path,
          }),
          ast.factory.createImport({
            name: ["toResultAsync"],
            path: runtime.neverthrow,
            root: file.path,
          }),
          ast.factory.createImport({
            name: ["Options", "RequestError"],
            path: runtime.neverthrow,
            root: file.path,
            isTypeOnly: true,
          }),
          ast.factory.createImport({
            name: [names.options, names.responses],
            path: typesFile.path,
            root: file.path,
            isTypeOnly: true,
          }),
          ...success.imports.map((imp) =>
            ast.factory.createImport({
              name: imp.name,
              path: imp.path,
              root: file.path,
              isTypeOnly: true,
            }),
          ),
        ],
        sources: [
          ast.factory.createSource({
            name: names.error,
            isTypeOnly: true,
            isExportable: true,
            isIndexable: true,
            nodes: [
              ast.factory.createText(
                `export type ${names.error} = RequestError<${names.responses}>;\n`,
              ),
            ],
          }),
          ast.factory.createSource({
            name: names.fn,
            isExportable: true,
            isIndexable: true,
            nodes: [
              ast.factory.createText(
                renderOperationFunction({ node, names, success }),
              ),
            ],
          }),
        ],
      }),
    ];
  },
});

/**
 * `@kubb/plugin-fetch` の client を neverthrow の `ResultAsync` で包んだ関数を
 * operation ごとに生成する。型は `@kubb/plugin-ts`、HTTP 呼び出しは
 * `@kubb/plugin-fetch` の `.kubb/client.ts` に依存する。
 */
export const pluginFetchNeverthrow = definePlugin<PluginFetchNeverthrow>(
  (options) => {
    const { output = { path: "fetch-neverthrow", barrel: { type: "named" } } } =
      options;

    return {
      name: pluginFetchNeverthrowName,
      options,
      // 実行順のヒント。plugin-ts の型と plugin-fetch の client を参照する
      dependencies: [pluginTsName, pluginFetchName],
      hooks: {
        "kubb:plugin:setup"(ctx) {
          ctx.setOptions({ output });
          ctx.addGenerator(clientGenerator);

          const root = path.resolve(ctx.config.root, ctx.config.output.path);
          ctx.injectFile(createRuntimeFile(root));
        },
      },
    };
  },
);
