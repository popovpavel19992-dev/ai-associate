"use client";

import { Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

export function CaseInvoicesTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = trpc.portalInvoices.list.useQuery({ caseId });
  const createCheckout = trpc.portalInvoices.createCheckoutSession.useMutation();

  const handlePay = async (invoiceId: string) => {
    const { url } = await createCheckout.mutateAsync({ invoiceId });
    if (url) window.location.href = url;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.invoices?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">No invoices</p>
        ) : (
          <div className="space-y-2">
            {data.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">#{inv.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    ${(inv.totalCents / 100).toFixed(2)}
                    {inv.dueDate && ` · Due ${new Date(inv.dueDate).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={STATUS_COLORS[inv.status]}>
                    {inv.status}
                  </Badge>
                  {inv.status === "sent" && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handlePay(inv.id)}
                      disabled={createCheckout.isPending}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Pay
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
