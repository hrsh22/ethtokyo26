import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow,opacity] duration-150 outline-none select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white shadow-btn hover:bg-[#2a2448]",
        light: "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)] hover:shadow-[inset_0_0_0_1.5px_#cfcae0]",
        soft: "bg-soft text-ink hover:bg-[#ebe9f3]",
        ghost: "text-ink-soft hover:bg-white/70 hover:text-ink",
        danger: "bg-bad-soft text-bad hover:bg-[#ffd6de]",
        onColor: "bg-white/60 text-current backdrop-blur hover:bg-white/80",
      },
      size: {
        sm: "h-9 px-4 text-sm [&_svg]:size-4",
        md: "h-11 px-5 text-[15px] [&_svg]:size-[18px]",
        lg: "h-14 px-7 text-base [&_svg]:size-5",
        icon: "size-10 [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

function Button({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined} {...props}>
      {asChild ? children : <>{loading ? <Loader2 className="animate-spin" /> : null}{children}</>}
    </Comp>
  );
}

export { Button, buttonVariants };
