import { assign, fromPromise, setup } from "xstate";

import { getSession, login, logout, signup } from "../api";
import { errorMessage } from "../errors";
import type { LoginRequest, SignupRequest, User } from "../types";
import { dashboardMachine, type DashboardOutputEvent } from "./dashboardMachine";

type AppContext = {
  user: User | null;
  authError: string;
  toastMessage: string | null;
};

type AppEvent =
  | { type: "LOGIN_SUBMITTED"; payload: LoginRequest }
  | { type: "SIGNUP_SUBMITTED"; payload: SignupRequest }
  | { type: "LOGOUT_REQUESTED" }
  | { type: "TOAST_DISMISSED" }
  | { type: "AUTH_ERROR_CLEARED" }
  | DashboardOutputEvent;

const appSetup = setup({
  types: {
    context: {} as AppContext,
    events: {} as AppEvent,
  },
  actors: {
    dashboardMachine,
    getSession: fromPromise<User, undefined>(({ signal }) => getSession({ signal })),
    login: fromPromise<User, LoginRequest>(({ input, signal }) => login(input, { signal })),
    signup: fromPromise<User, SignupRequest>(({ input, signal }) => signup(input, { signal })),
    logout: fromPromise<null, undefined>(({ signal }) => logout({ signal })),
  },
  actions: {
    clearAuthenticatedData: assign({
      user: null,
      authError: "",
      toastMessage: null,
    }),
    showToast: assign(({ event }) => {
      if (event.type !== "TOAST_REQUESTED") {
        return {};
      }
      return {
        toastMessage: event.message,
      };
    }),
  },
});

export const appMachine = appSetup.createMachine({
  id: "app",
  context: initialContext,
  initial: "checkingSession",
  on: {
    TOAST_DISMISSED: {
      actions: assign({
        toastMessage: null,
      }),
    },
  },
  states: {
    checkingSession: {
      invoke: {
        src: "getSession",
        input: () => undefined,
        onDone: {
          target: "signedIn",
          actions: assign(({ event }) => ({
            user: event.output,
            authError: "",
          })),
        },
        onError: {
          target: "signedOut.idle",
          actions: { type: "clearAuthenticatedData" },
        },
      },
    },
    signedOut: {
      initial: "idle",
      on: {
        AUTH_ERROR_CLEARED: {
          actions: assign({
            authError: "",
          }),
        },
      },
      states: {
        idle: {
          on: {
            LOGIN_SUBMITTED: {
              target: "loggingIn",
            },
            SIGNUP_SUBMITTED: {
              target: "signingUp",
            },
          },
        },
        loggingIn: {
          invoke: {
            src: "login",
            input: ({ event }) => {
              if (event.type !== "LOGIN_SUBMITTED") {
                throw new Error("Login payload is missing");
              }
              return event.payload;
            },
            onDone: {
              target: "#app.signedIn",
              actions: assign(({ event }) => ({
                user: event.output,
                authError: "",
                toastMessage: "Signed in",
              })),
            },
            onError: {
              target: "idle",
              actions: assign(({ event }) => ({
                authError: errorMessage(event.error),
              })),
            },
          },
        },
        signingUp: {
          invoke: {
            src: "signup",
            input: ({ event }) => {
              if (event.type !== "SIGNUP_SUBMITTED") {
                throw new Error("Signup payload is missing");
              }
              return event.payload;
            },
            onDone: {
              target: "#app.signedIn",
              actions: assign(({ event }) => ({
                user: event.output,
                authError: "",
                toastMessage: "Account created",
              })),
            },
            onError: {
              target: "idle",
              actions: assign(({ event }) => ({
                authError: errorMessage(event.error),
              })),
            },
          },
        },
      },
    },
    signedIn: {
      invoke: {
        id: "dashboard",
        src: "dashboardMachine",
        input: ({ context }) => ({
          user: context.user,
        }),
      },
      on: {
        LOGOUT_REQUESTED: {
          target: "loggingOut",
        },
        UNAUTHORIZED: {
          target: "signedOut.idle",
          actions: { type: "clearAuthenticatedData" },
        },
        TOAST_REQUESTED: {
          actions: { type: "showToast" },
        },
      },
    },
    loggingOut: {
      invoke: {
        src: "logout",
        input: () => undefined,
        onDone: {
          target: "signedOut.idle",
          actions: assign(() => ({
            ...resetAuthenticatedContext(),
            toastMessage: "Signed out",
          })),
        },
        onError: {
          target: "signedOut.idle",
          actions: assign(() => ({
            ...resetAuthenticatedContext(),
            toastMessage: "Signed out",
          })),
        },
      },
    },
  },
});

function initialContext(): AppContext {
  return {
    user: null,
    authError: "",
    toastMessage: null,
  };
}

function resetAuthenticatedContext(): AppContext {
  return {
    user: null,
    authError: "",
    toastMessage: null,
  };
}
