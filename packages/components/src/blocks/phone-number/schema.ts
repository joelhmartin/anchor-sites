import { z } from "zod";

export const phoneNumberSchema = z.object({
  number: z.string().min(1).default("+15550000000"),
  display: z.string().optional(),
});

export type PhoneNumberProps = z.infer<typeof phoneNumberSchema>;
