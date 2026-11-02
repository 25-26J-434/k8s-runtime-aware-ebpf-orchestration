"use client";

import { useRef, useState } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";

/** Collects antd's CSS-in-JS during SSR and injects it once into the stream, so first paint is styled. */
export function AntdRegistry({ children }: { children: React.ReactNode }) {
  const [cache] = useState(() => createCache());
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    // prepend + low priority: client-side style updates (theme switch) must come later in <head> and win.
    return (
      <style
        id="antd-cssinjs"
        data-rc-order="prepend"
        data-rc-priority="-1000"
        dangerouslySetInnerHTML={{ __html: extractStyle(cache, { plain: true }) }}
      />
    );
  });

  return <StyleProvider cache={cache}>{children}</StyleProvider>;
}
