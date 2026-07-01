export interface CommandResponse<T> {
  ok: boolean;
  data: T;
}

export interface CommandError {
  kind?: string;
  code: string;
  message: string;
  detail?: string | null;
  recoverable: boolean;
}

export interface HealthPayload {
  message: string;
  backend: string;
}
