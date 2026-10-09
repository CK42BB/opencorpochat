// SPDX-License-Identifier: AGPL-3.0-only

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);
