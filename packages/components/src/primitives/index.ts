/**
 * Internal primitives barrel. Re-exports for use inside the package only —
 * NOT re-exported from the package root (`src/index.ts`). Opinionated
 * blocks compose these; consumers never import primitives directly.
 *
 * If you add a primitive here, also add a render test in
 * `src/primitives/__tests__/`.
 */

export { Button, buttonVariants, type ButtonProps } from "./button.js";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card.js";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion.js";
export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  useCarousel,
  type CarouselProps,
} from "./carousel.js";
export { Slot } from "./slot.js";
