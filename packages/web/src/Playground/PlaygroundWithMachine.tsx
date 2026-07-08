import { useInterpret } from "@xstate/react";
import { useEffect, useState } from "react";
import { initTailwindContext } from "tw2panda";
import { Playground } from "./Playground";
import { playgroundMachine } from "./Playground.machine";
import { PlaygroundMachineProvider } from "./PlaygroundMachineProvider";

export const PlaygroundWithMachine = () => {
  const service = useInterpret(playgroundMachine);

  // Tailwind v4 loads its design system asynchronously (CSS-first). Initialize
  // it once before mounting the editors so the machine can read the cached
  // context synchronously when a class list is extracted.
  const [twReady, setTwReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initTailwindContext()
      .then(() => !cancelled && setTwReady(true))
      .catch((error) => console.error("Failed to initialize Tailwind context", error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!twReady) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#94a3b8" }}>
        Loading Tailwind…
      </div>
    );
  }

  return (
    <PlaygroundMachineProvider value={service}>
      <Playground />
    </PlaygroundMachineProvider>
  );
};

export default PlaygroundWithMachine;
