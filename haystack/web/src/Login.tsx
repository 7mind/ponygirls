import { SignedOutMasthead } from "./Masthead";

/** Signed-out view: the shared account module renders sign-in, sign-up, recovery and enrollment into the mount. */
export function Login() {
  return <><SignedOutMasthead /><main id="main" data-account-auth="" /></>;
}
