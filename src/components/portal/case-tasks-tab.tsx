"use client";

import { Loader2, CheckCircle2, Circle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const STATUS_ICON: Record<string, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  done: CheckCircle2,
};

export function CaseTasksTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = trpc.portalTasks.list.useQuery({ caseId });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.tasks?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">No tasks</p>
        ) : (
          <div className="space-y-2">
            {data.tasks.map((task) => {
              const Icon = STATUS_ICON[task.status] ?? Circle;
              return (
                <div key={task.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Icon className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                    )}
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="shrink-0">{task.status}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
