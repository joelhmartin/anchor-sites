import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

export function ForgotPasswordForm() {
  const { addToast } = useToast();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = async (data) => {
    try {
      await api.post("/auth/forgot-password", data);
      setSent(true);
    } catch (err) {
      addToast({ message: "Something went wrong. Please try again.", type: "error" });
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-sm text-gray-600">
          If an account exists with that email, we've sent a password reset link.
        </p>
      </div>
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
        Send reset link
      </Button>
    </form>
  );
}
