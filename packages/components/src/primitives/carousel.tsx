import * as React from "react";
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react";
import { cn } from "../lib/cn.js";

type EmblaApi = UseEmblaCarouselType[1];
type EmblaOptions = Parameters<typeof useEmblaCarousel>[0];
type EmblaPlugins = Parameters<typeof useEmblaCarousel>[1];

type CarouselContextValue = {
  emblaRef: ReturnType<typeof useEmblaCarousel>[0];
  api: EmblaApi;
  canScrollPrev: boolean;
  canScrollNext: boolean;
  scrollPrev: () => void;
  scrollNext: () => void;
  orientation: "horizontal" | "vertical";
};

const CarouselContext = React.createContext<CarouselContextValue | null>(null);

function useCarousel() {
  const ctx = React.useContext(CarouselContext);
  if (!ctx) {
    throw new Error("useCarousel must be used inside <Carousel>");
  }
  return ctx;
}

export type CarouselProps = React.HTMLAttributes<HTMLDivElement> & {
  opts?: EmblaOptions;
  plugins?: EmblaPlugins;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: EmblaApi) => void;
};

export const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  ({ opts, plugins, orientation = "horizontal", setApi, className, children, ...props }, ref) => {
    const [emblaRef, api] = useEmblaCarousel(
      { ...opts, axis: orientation === "horizontal" ? "x" : "y" },
      plugins,
    );
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);

    const onSelect = React.useCallback((emblaApi: NonNullable<EmblaApi>) => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    }, []);

    const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api]);
    const scrollNext = React.useCallback(() => api?.scrollNext(), [api]);

    React.useEffect(() => {
      if (!api) return;
      onSelect(api);
      api.on("select", onSelect);
      api.on("reInit", onSelect);
      return () => {
        api.off("select", onSelect);
        api.off("reInit", onSelect);
      };
    }, [api, onSelect]);

    React.useEffect(() => {
      if (api && setApi) setApi(api);
    }, [api, setApi]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        scrollPrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        scrollNext();
      }
    };

    return (
      <CarouselContext.Provider
        value={{ emblaRef, api, canScrollPrev, canScrollNext, scrollPrev, scrollNext, orientation }}
      >
        <div
          ref={ref}
          role="region"
          aria-roledescription="carousel"
          onKeyDown={handleKeyDown}
          tabIndex={0}
          className={cn("relative outline-none", className)}
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

export const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { emblaRef, orientation } = useCarousel();
    return (
      <div ref={emblaRef} className="overflow-hidden">
        <div
          ref={ref}
          className={cn("flex", orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col", className)}
          {...props}
        />
      </div>
    );
  },
);
CarouselContent.displayName = "CarouselContent";

export const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { orientation } = useCarousel();
    return (
      <div
        ref={ref}
        role="group"
        aria-roledescription="slide"
        className={cn(
          "min-w-0 shrink-0 grow-0 basis-full",
          orientation === "horizontal" ? "pl-4" : "pt-4",
          className,
        )}
        {...props}
      />
    );
  },
);
CarouselItem.displayName = "CarouselItem";

type ArrowButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label"> & {
  label?: string;
};

export const CarouselPrevious = React.forwardRef<HTMLButtonElement, ArrowButtonProps>(
  ({ className, label = "Previous slide", children, ...props }, ref) => {
    const { scrollPrev, canScrollPrev } = useCarousel();
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={!canScrollPrev}
        onClick={scrollPrev}
        className={cn(
          "absolute left-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-10 w-10 rounded-full border border-theme-border bg-theme-surface text-theme-on-surface shadow-sm disabled:opacity-40 disabled:pointer-events-none",
          className,
        )}
        {...props}
      >
        {children ?? <span aria-hidden="true">‹</span>}
      </button>
    );
  },
);
CarouselPrevious.displayName = "CarouselPrevious";

export const CarouselNext = React.forwardRef<HTMLButtonElement, ArrowButtonProps>(
  ({ className, label = "Next slide", children, ...props }, ref) => {
    const { scrollNext, canScrollNext } = useCarousel();
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={!canScrollNext}
        onClick={scrollNext}
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-10 w-10 rounded-full border border-theme-border bg-theme-surface text-theme-on-surface shadow-sm disabled:opacity-40 disabled:pointer-events-none",
          className,
        )}
        {...props}
      >
        {children ?? <span aria-hidden="true">›</span>}
      </button>
    );
  },
);
CarouselNext.displayName = "CarouselNext";

export { useCarousel };
