import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { useToast } from "../ui/Toast.jsx";

export function RegisterForm() {
  const { register: registerUser } = useAuth();
  const { addToast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data) => {
    try {
      await registerUser(data);
      addToast({ message: "Account created! Please verify your email.", type: "success" });
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Registration failed",
        type: "error",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Name"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
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
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Create account
      </Button>
    </form>
  );
}
