import 'express';

declare module 'express' {
  interface Request {
    requestMeta?: {
      ip_address: string;
      user_agent: string;
    };
  }
}
