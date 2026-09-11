import { getBook } from "./generated/fetch-neverthrow";

const result = await getBook({ path: { isbn: "4299039009" } });

result.match(
  (book) => console.log("ok", book.title),
  (error) => {
    switch (error.kind) {
      case "transport":
        console.error("transport", error.cause);
        break;
      case "http":
        // OpenAPI に書かれた 404 だけがここに来る。status は 404、body は ApiError に絞られている
        console.error(error.status, error.body.code, error.body.message);
        break;
      case "unexpected":
        console.error("unexpected", error.status, error.body);
        break;
      default:
        error satisfies never;
    }
  },
);
