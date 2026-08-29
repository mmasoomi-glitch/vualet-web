import { permanentRedirect } from "next/navigation";

// This page previously announced a third-party authentication integration
// that was never adopted. Working magic-link sign-in shipped at /mira/login,
// so a 308 permanent redirect ensures bookmarks and crawlers transfer to the
// actual sign-in page.
export default function LoginRedirect(): never {
  permanentRedirect("/mira/login");
}
