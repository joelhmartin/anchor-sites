import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { magicLinkSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

export function MagicLinkForm() {
  const { addToast } = useToast();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(magicLinkSchema) });

  const onSubmit = async (data) => {
    try {
      await api.post("/auth/magic-link", data);
      setSent(true);
    } catch {
      addToast({ message: "Something went wrong.", type: "error" });
    }
  };

  if (sent) {
    return (
      <p className="text-center text-sm text-gray-600">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Send magic link
      </Button>
    </form>
  );
}
