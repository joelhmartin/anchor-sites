import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../primitives/accordion.js";
import { Editable } from "../../editable.js";
import type { FaqAccordionProps } from "./schema.js";

export function FaqAccordion({ heading, items, multiple }: FaqAccordionProps) {
  return (
    <section className="ac-faq-accordion py-16 px-6 bg-theme-surface text-theme-on-surface">
      <div className="ac-faq-accordion__inner max-w-3xl mx-auto">
        <Editable
          field="heading"
          as="h2"
          className="ac-faq-accordion__heading text-3xl mb-8 text-center"
          value={heading}
        />
        {multiple ? (
          <Accordion type="multiple" className="ac-faq-accordion__list">
            {items.map((item, i) => (
              <AccordionItem key={i} value={String(i)}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <Accordion type="single" collapsible className="ac-faq-accordion__list">
            {items.map((item, i) => (
              <AccordionItem key={i} value={String(i)}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </section>
  );
}
