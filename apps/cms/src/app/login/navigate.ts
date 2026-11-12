/**
 * A full navigation to a path on this origin: the next request goes through the proxy and the
 * server's routing (the tenant home, the console's MFA step) with the cookies the sign-in wrote.
 * Its own module so the form's tests can watch it.
 */
export function goTo(path: string): void {
  window.location.assign(path);
}
