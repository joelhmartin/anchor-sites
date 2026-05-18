import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { ResetPasswordForm } from "../../components/auth/ResetPasswordForm.jsx";
import { Card } from "../../components/ui/Card.jsx";

export function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Card>
        <h2 className="mb-6 text-center text-xl font-semibold">Set new password</h2>
        <ResetPasswordForm />
      </Card>
    </AuthLayout>
  );
}
