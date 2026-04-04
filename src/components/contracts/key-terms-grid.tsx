interface KeyTerm {
  term: string;
  value: string;
  section_ref?: string;
}

interface KeyTermsGridProps {
  terms: KeyTerm[];
}

export function KeyTermsGrid({ terms }: KeyTermsGridProps) {
  if (terms.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No key terms found.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2 text-left font-medium">Term</th>
            <th className="px-4 py-2 text-left font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((term, idx) => (
            <tr key={idx} className="border-b last:border-b-0">
              <td className="px-4 py-2 font-medium">
                {term.term}
                {term.section_ref && (
                  <span className="ml-1 text-xs text-muted-foreground">({term.section_ref})</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{term.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
