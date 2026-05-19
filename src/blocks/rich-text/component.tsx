import type { RichTextProps } from "./schema.js";

export function RichText({ html, max_width }: RichTextProps) {
  return (
    <section className={`ac-rich-text ac-rich-text--${max_width}`}>
      <div className="ac-rich-text__inner" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
