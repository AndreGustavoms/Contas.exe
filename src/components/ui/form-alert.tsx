import { AlertCircle, CheckCircle2, Info } from "lucide-react";

type AlertVariant = "error" | "success" | "info";

type FormAlertProps = {
  variant?: AlertVariant;
  title?: string;
  message: string;
};

const icons = {
  error: <AlertCircle className="form-alert__icon h-4 w-4" />,
  success: <CheckCircle2 className="form-alert__icon h-4 w-4" />,
  info: <Info className="form-alert__icon h-4 w-4" />,
};

export function FormAlert({
  variant = "error",
  title,
  message,
}: FormAlertProps) {
  return (
    <div
      key={message}
      className={`form-alert form-alert--${variant}`}
      role="alert"
      aria-live="polite"
    >
      {icons[variant]}
      <div className="form-alert__text">
        {title && <strong>{title}</strong>}
        <span>{message}</span>
      </div>
    </div>
  );
}
