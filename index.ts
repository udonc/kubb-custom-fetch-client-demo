import { err, ok, type Result, ResultAsync } from "neverthrow";
import { getBook } from "./generated/clients";
import type { ApiError } from "./generated/types/ApiError";
import type { Book } from "./generated/types/Book";

type GetBookError =
  | { kind: "notFound"; cause: ApiError }
  | { kind: "transport"; cause: unknown };

const fetchBook = (isbn: string): ResultAsync<Book, GetBookError> =>
  ResultAsync.fromPromise(
    getBook({ path: { isbn }, throwOnError: false }),
    (cause): GetBookError => ({ kind: "transport", cause }),
  ).andThen((res): Result<Book, GetBookError> => {
    switch (res.status) {
      case 200:
        return ok(res.data);
      case 404:
        return err({ kind: "notFound", cause: res.error });
      default:
        return res satisfies never;
    }
  });

const result = await fetchBook("4299039009");

result.match(
  (book) => console.log("ok", book.title),
  ({ kind, cause }) => console.error(kind, cause),
);
