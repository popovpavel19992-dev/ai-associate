"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { NewWitnessListDialog } from "./new-witness-list-dialog";
import { NewExhibitListDialog } from "./new-exhibit-list-dialog";
import { NewJuryInstructionSetDialog } from "./new-jury-instruction-set-dialog";
import { NewVoirDireSetDialog } from "./new-voir-dire-set-dialog";
import { NewDepositionOutlineDialog } from "./new-deposition-outline-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  submitted: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

export function TrialPrepTab({ caseId }: { caseId: string }) {
  const [showNewWitness, setShowNewWitness] = useState(false);
  const [showNewExhibit, setShowNewExhibit] = useState(false);
  const [showNewJury, setShowNewJury] = useState(false);
  const [showNewVoirDire, setShowNewVoirDire] = useState(false);
  const [showNewDeposition, setShowNewDeposition] = useState(false);
  const { data: witnessLists, isLoading: witnessLoading } =
    trpc.witnessLists.listForCase.useQuery({ caseId });
  const { data: exhibitLists, isLoading: exhibitLoading } =
    trpc.exhibitLists.listForCase.useQuery({ caseId });
  const { data: jurySets, isLoading: juryLoading } =
    trpc.juryInstructions.listForCase.useQuery({ caseId });
  const { data: voirDireSets, isLoading: voirLoading } =
    trpc.voirDire.listForCase.useQuery({ caseId });
  const { data: depositionOutlines, isLoading: depLoading } =
    trpc.depositionPrep.listForCase.useQuery({ caseId });

  const groupedWitness = (witnessLists ?? []).reduce<
    Record<string, NonNullable<typeof witnessLists>>
  >((acc, l) => {
    const key = l.servingParty;
    if (!acc[key]) acc[key] = [] as unknown as NonNullable<typeof witnessLists>;
    (acc[key] as unknown as typeof l[]).push(l);
    return acc;
  }, {} as Record<string, NonNullable<typeof witnessLists>>);

  const groupedExhibit = (exhibitLists ?? []).reduce<
    Record<string, NonNullable<typeof exhibitLists>>
  >((acc, l) => {
    const key = l.servingParty;
    if (!acc[key]) acc[key] = [] as unknown as NonNullable<typeof exhibitLists>;
    (acc[key] as unknown as typeof l[]).push(l);
    return acc;
  }, {} as Record<string, NonNullable<typeof exhibitLists>>);

  const groupedJury = (jurySets ?? []).reduce<
    Record<string, NonNullable<typeof jurySets>>
  >((acc, l) => {
    const key = l.servingParty;
    if (!acc[key]) acc[key] = [] as unknown as NonNullable<typeof jurySets>;
    (acc[key] as unknown as typeof l[]).push(l);
    return acc;
  }, {} as Record<string, NonNullable<typeof jurySets>>);

  const groupedVoirDire = (voirDireSets ?? []).reduce<
    Record<string, NonNullable<typeof voirDireSets>>
  >((acc, l) => {
    const key = l.servingParty;
    if (!acc[key])
      acc[key] = [] as unknown as NonNullable<typeof voirDireSets>;
    (acc[key] as unknown as typeof l[]).push(l);
    return acc;
  }, {} as Record<string, NonNullable<typeof voirDireSets>>);

  const witnessSectionLabel = (k: string) =>
    k === "plaintiff" ? "Plaintiff's Witness Lists" : "Defendant's Witness Lists";
  const exhibitSectionLabel = (k: string) =>
    k === "plaintiff" ? "Plaintiff's Exhibit Lists" : "Defendant's Exhibit Lists";
  const jurySectionLabel = (k: string) =>
    k === "plaintiff"
      ? "Plaintiff's Jury Instruction Sets"
      : "Defendant's Jury Instruction Sets";
  const voirDireSectionLabel = (k: string) =>
    k === "plaintiff"
      ? "Plaintiff's Voir Dire Sets"
      : "Defendant's Voir Dire Sets";

  return (
    <div className="space-y-8 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Trial Prep</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowNewWitness(true)}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Witness List
          </button>
          <button
            type="button"
            onClick={() => setShowNewExhibit(true)}
            className="inline-flex items-center rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            New Exhibit List
          </button>
          <button
            type="button"
            onClick={() => setShowNewJury(true)}
            className="inline-flex items-center rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            New Jury Instruction Set
          </button>
          <button
            type="button"
            onClick={() => setShowNewVoirDire(true)}
            className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            New Voir Dire Set
          </button>
          <button
            type="button"
            onClick={() => setShowNewDeposition(true)}
            className="inline-flex items-center rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            New Deposition Outline
          </button>
        </div>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Witness Lists</h3>

        {witnessLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!witnessLoading && (witnessLists ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No witness lists yet. Create one to start identifying trial witnesses.
          </p>
        )}

        {(["plaintiff", "defendant"] as const).map((party) => {
          const items = (groupedWitness[party] ?? []) as unknown as NonNullable<
            typeof witnessLists
          >;
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => a.listNumber - b.listNumber);
          return (
            <div key={`w-${party}`} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {witnessSectionLabel(party)}
              </h4>
              <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                {sorted.map((l) => (
                  <li key={l.id} className="hover:bg-zinc-900/40">
                    <Link
                      href={`/cases/${caseId}/trial-prep/witness-lists/${l.id}`}
                      className="block p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{l.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[l.status] ?? "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {l.status}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>List {l.listNumber}</span>
                        <span>
                          {l.witnessCount} witness{l.witnessCount === 1 ? "" : "es"}
                        </span>
                        <span>Created {new Date(l.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Exhibit Lists</h3>

        {exhibitLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!exhibitLoading && (exhibitLists ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No exhibit lists yet. Create one to start identifying trial exhibits.
          </p>
        )}

        {(["plaintiff", "defendant"] as const).map((party) => {
          const items = (groupedExhibit[party] ?? []) as unknown as NonNullable<
            typeof exhibitLists
          >;
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => a.listNumber - b.listNumber);
          return (
            <div key={`e-${party}`} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {exhibitSectionLabel(party)}
              </h4>
              <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                {sorted.map((l) => (
                  <li key={l.id} className="hover:bg-zinc-900/40">
                    <Link
                      href={`/cases/${caseId}/trial-prep/exhibit-lists/${l.id}`}
                      className="block p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{l.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[l.status] ?? "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {l.status}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>List {l.listNumber}</span>
                        <span>
                          {l.exhibitCount} exhibit{l.exhibitCount === 1 ? "" : "s"}
                        </span>
                        <span>Created {new Date(l.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Jury Instruction Sets</h3>

        {juryLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!juryLoading && (jurySets ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No proposed jury instructions yet. Create a set to draft instructions
            for the judge.
          </p>
        )}

        {(["plaintiff", "defendant"] as const).map((party) => {
          const items = (groupedJury[party] ?? []) as unknown as NonNullable<
            typeof jurySets
          >;
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => a.setNumber - b.setNumber);
          return (
            <div key={`j-${party}`} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {jurySectionLabel(party)}
              </h4>
              <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                {sorted.map((s) => (
                  <li key={s.id} className="hover:bg-zinc-900/40">
                    <Link
                      href={`/cases/${caseId}/trial-prep/jury-instructions/${s.id}`}
                      className="block p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>Set {s.setNumber}</span>
                        <span>
                          {s.instructionCount} instruction
                          {s.instructionCount === 1 ? "" : "s"}
                        </span>
                        <span>Created {new Date(s.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Voir Dire Sets</h3>

        {voirLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!voirLoading && (voirDireSets ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No voir dire sets yet. Create one to draft jury selection questions.
          </p>
        )}

        {(["plaintiff", "defendant"] as const).map((party) => {
          const items = (groupedVoirDire[party] ?? []) as unknown as NonNullable<
            typeof voirDireSets
          >;
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => a.setNumber - b.setNumber);
          return (
            <div key={`v-${party}`} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {voirDireSectionLabel(party)}
              </h4>
              <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                {sorted.map((s) => (
                  <li key={s.id} className="hover:bg-zinc-900/40">
                    <Link
                      href={`/cases/${caseId}/trial-prep/voir-dire/${s.id}`}
                      className="block p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>Set {s.setNumber}</span>
                        <span>
                          {s.questionCount} question
                          {s.questionCount === 1 ? "" : "s"}
                        </span>
                        <span>Created {new Date(s.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Depositions</h3>

        {depLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!depLoading && (depositionOutlines ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No deposition outlines yet. Create one to draft questions for a
            deponent.
          </p>
        )}

        {(depositionOutlines ?? []).length > 0 && (
          <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {[...(depositionOutlines ?? [])]
              .sort((a, b) => {
                const n = a.deponentName.localeCompare(b.deponentName);
                if (n !== 0) return n;
                return a.outlineNumber - b.outlineNumber;
              })
              .map((o) => (
                <li key={o.id} className="hover:bg-zinc-900/40">
                  <Link
                    href={`/cases/${caseId}/trial-prep/depositions/${o.id}`}
                    className="block p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{o.title}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_BADGE[o.status] ?? "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {o.status}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Deponent: {o.deponentName}</span>
                      <span>Outline {o.outlineNumber}</span>
                      <span>
                        {o.topicCount} topic{o.topicCount === 1 ? "" : "s"}
                      </span>
                      <span>
                        {o.questionCount} question
                        {o.questionCount === 1 ? "" : "s"}
                      </span>
                      {o.scheduledDate && (
                        <span>Scheduled {o.scheduledDate}</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>

      {showNewWitness && (
        <NewWitnessListDialog
          caseId={caseId}
          onClose={() => setShowNewWitness(false)}
        />
      )}
      {showNewExhibit && (
        <NewExhibitListDialog
          caseId={caseId}
          onClose={() => setShowNewExhibit(false)}
        />
      )}
      {showNewJury && (
        <NewJuryInstructionSetDialog
          caseId={caseId}
          onClose={() => setShowNewJury(false)}
        />
      )}
      {showNewVoirDire && (
        <NewVoirDireSetDialog
          caseId={caseId}
          onClose={() => setShowNewVoirDire(false)}
        />
      )}
      {showNewDeposition && (
        <NewDepositionOutlineDialog
          caseId={caseId}
          onClose={() => setShowNewDeposition(false)}
        />
      )}
    </div>
  );
}
