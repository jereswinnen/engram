export type EnhancementSearchFields = {
  overview: string
  keyPoints: string[]
  decisions: string[]
  actionItems: Array<{
    text: string
    owner?: string | null
    due?: string | null
  }>
  chapters: Array<{
    title: string
    gist: string
    startSeconds?: number | null
  }>
  openQuestions: string[]
}

export function buildEnhancementSearchText(
  enhancement: EnhancementSearchFields
): string {
  return [
    enhancement.overview,
    ...enhancement.keyPoints,
    ...enhancement.decisions,
    ...enhancement.actionItems.flatMap((item) => [
      item.text,
      item.owner ?? "",
      item.due ?? "",
    ]),
    ...enhancement.chapters.flatMap((chapter) => [chapter.title, chapter.gist]),
    ...enhancement.openQuestions,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
}
