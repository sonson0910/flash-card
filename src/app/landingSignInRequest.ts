export interface LandingSignInRequestRef {
  current: number;
}

export async function consumeLandingSignInRequest(
  request: number | null | undefined,
  handledRequestRef: LandingSignInRequestRef,
  acknowledge: (request: number) => void,
  signIn: () => void | Promise<unknown>,
): Promise<boolean> {
  if (request === null || request === undefined || request <= handledRequestRef.current) return false;
  handledRequestRef.current = request;
  acknowledge(request);
  await signIn();
  return true;
}
