"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> & { align?: "start" | "center" | "end" }
>(({ className, align = "center", ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner side="bottom" align={align}>
      <PopoverPrimitive.Popup
        ref={ref}
        className={cn(
          "z-50 rounded-md border border-zinc-200 bg-white p-4 text-zinc-950 shadow-md outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };
