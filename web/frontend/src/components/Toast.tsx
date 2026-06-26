type ToastProps = {
  message: string | null;
};

export function Toast({ message }: ToastProps) {
  const visible = message !== null && message !== "";

  return (
    <div id="toast" className={visible ? "show" : ""} role="status">
      {message}
    </div>
  );
}
