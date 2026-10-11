import { highlightSegments } from './model/highlight';

export function Highlight({ text, query }: { text: string; query: string }) {
  if (query === '') return <>{text}</>;
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.hit ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}
