import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer with compact, theme-aware styling (no prose plugin). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: content }) => <p className="mb-2 last:mb-0">{content}</p>,
          ul: ({ children: content }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{content}</ul>
          ),
          ol: ({ children: content }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{content}</ol>
          ),
          li: ({ children: content }) => <li>{content}</li>,
          h1: ({ children: content }) => (
            <h3 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{content}</h3>
          ),
          h2: ({ children: content }) => (
            <h3 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{content}</h3>
          ),
          h3: ({ children: content }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{content}</h4>
          ),
          a: ({ href, children: content }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              {content}
            </a>
          ),
          code: ({ className, children: content }) => {
            const block = Boolean(className);
            if (!block) {
              return (
                <code className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-700/60">
                  {content}
                </code>
              );
            }
            return <code className="font-mono text-xs">{content}</code>;
          },
          pre: ({ children: content }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-200 last:mb-0">
              {content}
            </pre>
          ),
          blockquote: ({ children: content }) => (
            <blockquote className="mb-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 last:mb-0 dark:border-zinc-700 dark:text-zinc-400">
              {content}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-800" />,
          table: ({ children: content }) => (
            <div className="mb-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{content}</table>
            </div>
          ),
          th: ({ children: content }) => (
            <th className="border border-zinc-200 px-2 py-1 text-left font-medium dark:border-zinc-800">
              {content}
            </th>
          ),
          td: ({ children: content }) => (
            <td className="border border-zinc-200 px-2 py-1 dark:border-zinc-800">{content}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
