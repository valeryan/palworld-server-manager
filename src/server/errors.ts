import "server-only";

// Errors that carry their HTTP status. Services throw these for client-facing outcomes so route
// handlers never have to infer a status from message text.
export class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = new.target.name; }
}
export class NotFoundError extends HttpError { constructor(message = "Not found.") { super(message, 404); } }
export class ConflictError extends HttpError { constructor(message: string) { super(message, 409); } }
export class ForbiddenError extends HttpError { constructor(message: string) { super(message, 403); } }
export class UnauthorizedError extends HttpError { constructor(message: string) { super(message, 401); } }
