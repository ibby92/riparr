import { z } from "zod";

export const credentialsInput = z
  .object({
    username: z.string().trim().min(1, "Username is required").max(100),
    password: z.string().min(8, "Use at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
