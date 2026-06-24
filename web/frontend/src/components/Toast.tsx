type ToastProps = {
  message: string | null;
};

export function Toast({ message }: ToastProps) {
  return (
    <div id="toast" className={message ? "show" : ""} role="status">
      {message}
    </div>
  );
}
