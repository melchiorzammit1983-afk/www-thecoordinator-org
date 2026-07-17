import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { getArticle } from "@/content/help/manifest";
import { cn } from "@/lib/utils";

export function HelpLink({
  slug,
  className,
  inline,
}: {
  slug: string;
  className?: string;
  inline?: boolean;
}) {
  const article = getArticle(slug);
  if (!article) return null;
  return (
    <Link
      to="/help/$topic"
      params={{ topic: slug }}
      className={cn(
        "inline-flex items-center gap-1.5 text-primary hover:underline",
        inline ? "text-sm" : "text-sm font-medium",
        className,
      )}
    >
      <BookOpen className="h-3.5 w-3.5" />
      {article.title}
    </Link>
  );
}
