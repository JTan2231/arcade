import { FormEvent, useState } from "react";

import type { LoginRequest, SignupRequest } from "../types";

type AuthMode = "login" | "signup";

type AuthViewProps = {
  error: string;
  submitting: boolean;
  onClearError: () => void;
  onLogin: (payload: LoginRequest) => void;
  onSignup: (payload: SignupRequest) => void;
};

export function AuthView({ error, submitting, onClearError, onLogin, onSignup }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>("login");

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    onClearError();
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onLogin({
      email: formString(form, "email"),
      password: formString(form, "password"),
      remember_me: form.get("remember_me") === "on",
    });
  }

  function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSignup({
      display_name: formString(form, "display_name"),
      email: formString(form, "email"),
      password: formString(form, "password"),
      remember_me: form.get("remember_me") === "on",
    });
  }

  return (
    <main className="auth-layout">
      <section className="panel auth-panel" aria-label="Authentication">
        <div className="auth-tabs" role="tablist" aria-label="Authentication">
          <button
            className={`auth-tab ${mode === "login" ? "active" : "secondary"}`}
            role="tab"
            aria-selected={mode === "login"}
            type="button"
            onClick={() => switchMode("login")}
          >
            Login
          </button>
          <button
            className={`auth-tab ${mode === "signup" ? "active" : "secondary"}`}
            role="tab"
            aria-selected={mode === "signup"}
            type="button"
            onClick={() => switchMode("signup")}
          >
            Signup
          </button>
        </div>

        {mode === "login" ? (
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <label className="checkbox-row">
              <input name="remember_me" type="checkbox" />
              Remember me
            </label>
            <button type="submit" disabled={submitting}>
              Login
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleSignup}>
            <label>
              Display name
              <input name="display_name" autoComplete="name" maxLength={100} required />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <label className="checkbox-row">
              <input name="remember_me" type="checkbox" />
              Remember me
            </label>
            <button type="submit" disabled={submitting}>
              Create account
            </button>
          </form>
        )}

        <div className="form-error" role="alert">
          {error}
        </div>
      </section>
    </main>
  );
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
