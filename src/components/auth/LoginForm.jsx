import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { useToast } from "../ui/Toast.jsx";
import { MfaChallenge } from "./MfaChallenge.jsx";

export function LoginForm() {
  const { login } = useAuth();
  const { addToast } = useToast();
  const [mfaState, setMfaState] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data) => {
    try {
      const result = await login(data);
      if (result?.mfaRequired) {
        setMfaState({ mfaToken: result.mfaToken });
      }
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || err.message || "Login failed",
        type: "error",
      });
    }
  };

  if (mfaState) {
    return <MfaChallenge mfaToken={mfaState.mfaToken} />;
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
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
