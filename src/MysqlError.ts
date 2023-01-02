export class MysqlError extends Error {
  errno: number | null = null;
  sqlState: string | null = null;
  sqlMessage: string | null = null;
  cause?: Error;

  constructor(message: string, public code: string, public isFatal: boolean) {
    super(message);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, MysqlError.prototype);
  }

  toString() {
    return this.message;
  }
}
