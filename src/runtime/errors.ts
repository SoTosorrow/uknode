export class WriteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
