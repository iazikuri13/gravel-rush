import { HttpError } from '../lib/http.js';

/** შეცდომა პლატფორმის კოდით (მაგ. INSUFFICIENT_FUNDS) — ადაპტერი მას პლატფორმის ფორმატში აბრუნებს */
export class PlatformError extends HttpError {
  constructor(code, message, status) { super(status || 400, message || code, code); }
}
