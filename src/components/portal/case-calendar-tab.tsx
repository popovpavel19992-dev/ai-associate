"use client";

import { format } from "date-fns";
import { Loader2, Calendar, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export function CaseCalendarTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = trpc.portalCalendar.list.useQuery({ caseId });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Events</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.events?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">No upcoming events</p>
        ) : (
          <div className="space-y-3">
            {data.events.map((event) => (
              <div key={event.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{event.title}</p>
                  <Badge variant="outline">{event.kind}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {format(new Date(event.startsAt), "MMM d, yyyy h:mm a")}
                    {event.endsAt && ` — ${format(new Date(event.endsAt), "h:mm a")}`}
                  </span>
                </div>
                {event.location && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span>{event.location}</span>
                  </div>
                )}
                {event.description && (
                  <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
