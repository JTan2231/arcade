type ToastProps = {
  message: string | null;
};

export function Toast({ message }: ToastProps) {
  const visible = message !== null && message !== "";

  return (
    <div className={`toast ${visible ? "toast-visible" : ""}`} role="status">
      {message}
    </div>
  );
}
