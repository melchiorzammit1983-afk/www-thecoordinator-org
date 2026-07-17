import { createFileRoute, notFound } from "@tanstack/react-router";
import { Suspense } from "react";
import { getArticle } from "@/content/help/manifest";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/help/$topic")({
  loader: ({ params }) => {
    const article = getArticle(params.topic);
    if (!article) throw notFound();
    return { article };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Article not found — The Coordinator Help" }, { name: "robots", content: "noindex" }] };
    }
    const a = loaderData.article;
    return {
      meta: [
        { title: `${a.title} — The Coordinator Help` },
        { name: "description", content: a.summary },
        { property: "og:title", content: `${a.title} — The Coordinator Help` },
        { property: "og:description", content: a.summary },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Article not found</h1>
      <p className="mt-2 text-muted-foreground">Check the sidebar for available topics.</p>
    </div>
  ),
  component: TopicPage,
});

function TopicPage() {
  const { article } = Route.useLoaderData();
  const Body = article.component;
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    }>
      <Body />
    </Suspense>
  );
}
