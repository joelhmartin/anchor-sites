import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { RegisterForm } from "../../components/auth/RegisterForm.jsx";
import { OAuthButtons } from "../../components/auth/OAuthButtons.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { ROUTES } from "../../config/routes.js";

export function RegisterPage() {
  return (
    <AuthLayout>
      <Card>
        <h2 className="mb-6 text-center text-xl font-semibold">Create your account</h2>
        <OAuthButtons />
        <div className="my-4 flex items-center gap-3">
          <hr className="flex-1 border-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <hr className="flex-1 border-gray-200" />
        </div>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link to={ROUTES.LOGIN} className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
