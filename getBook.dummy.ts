import { err, ok, type Result, ResultAsync } from "neverthrow";
import {
  type CallResult,
  client,
  type DataOf,
  type DataShape,
  type Options as KubbOptions,
  type SuccessOf,
  type SuccessStatusCode,
  type ToStatusNumber,
} from "./generated/.kubb/client";
import type { Book } from "./generated/types/Book";
import type {
  GetBookOptions,
  GetBookResponses,
} from "./generated/types/GetBook";

// --- 共通化できる部分 ---

/** レスポンスの取得に失敗（接続失敗, abort, body のパース失敗など） */
export type TransportError = { kind: "transport"; cause: unknown };

/** 想定されたエラーレスポンス */
export type HttpError<TResponses> = {
  [S in ErrorStatusOf<TResponses>]: {
    kind: "http";
    status: ToStatusNumber<S>;
    body: DataOf<TResponses[S]>;
  };
}[ErrorStatusOf<TResponses>];

/** 想定されていないレスポンス */
export type UnexpectedResponseError = {
  kind: "unexpected";
  status: number;
  body: unknown;
};

export type RequestError<TResponses> =
  | TransportError
  | HttpError<TResponses>
  | UnexpectedResponseError;

/** 生成した関数が受け取る options */
export type Options<TData extends DataShape> = Omit<
  KubbOptions<TData, false>,
  "throwOnError" // `throwOnError = false` で固定するので Omit している
>;

type ErrorStatusOf<TResponses> = Exclude<keyof TResponses, SuccessStatusCode>;
type SuccessDataOf<TResponses> = DataOf<SuccessOf<TResponses>>;

const isSuccessStatus = (status: number): boolean =>
  status >= 200 && status < 300;

const isDocumented = (
  documented: ReadonlyArray<number>,
  status: number,
): boolean => documented.includes(status);

/** Kubb client の実行を `ResultAsync` で包む */
export const toResultAsync = <TResponses>(
  /** Kubb client の結果 */
  call: Promise<CallResult>,
  /** OpenAPI に定義されたレスポンスの status のリスト */
  documented: ReadonlyArray<ToStatusNumber<keyof TResponses>>,
): ResultAsync<SuccessDataOf<TResponses>, RequestError<TResponses>> =>
  ResultAsync.fromPromise(
    call,
    (cause): RequestError<TResponses> => ({ kind: "transport", cause }),
  ).andThen(
    (res): Result<SuccessDataOf<TResponses>, RequestError<TResponses>> => {
      const success = isSuccessStatus(res.status);
      if (!isDocumented(documented, res.status)) {
        return err({
          kind: "unexpected",
          status: res.status,
          body: success ? res.data : res.error,
        });
      }
      // `if(isDocumented)` の early return を通過したので `TResponses` として読み替えてOK
      return success
        ? ok(res.data as SuccessDataOf<TResponses>)
        : err({
            kind: "http",
            status: res.status,
            body: res.error,
          } as HttpError<TResponses>);
    },
  );

// --- エンドポイントごとに生成する部分 ---

export type GetBookError = RequestError<GetBookResponses>;

/**
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
}
