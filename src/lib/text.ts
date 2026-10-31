export const cleanText = (text: string) =>
  text.replace(/\[[^\]\r\n]*\]/g, "").trim();
export function insertTag(
  text: string,
  tag: string,
  start: number,
  end: number,
) {
  return {
    text: text.slice(0, start) + tag + text.slice(end),
    cursor: start + tag.length,
  };
}
export const durationLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
