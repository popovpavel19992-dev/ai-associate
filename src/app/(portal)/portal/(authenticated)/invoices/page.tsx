"use client";

import { Loader2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

export default function PortalInvoicesPage() {
  const { data, isLoading } = trpc.portalInvoices.list.useQuery();
  const createCheckout = trpc.portalInvoices.createCheckoutSession.useMutation();

  const handlePay = async (invoiceId: string) => {
    const { url } = await createCheckout.mutateAsync({ invoiceId });
    if (url) window.location.href = url;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Invoices</h1>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.invoices?.length ? (
        <p className="text-muted-foreground text-center py-12">No invoices</p>
      ) : (
        <div className="space-y-3">
          {data.invoices.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Invoice #{inv.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    ${(inv.totalCents / 100).toFixed(2)}
                    {inv.dueDate && ` · Due ${new Date(inv.dueDate).toLocaleDateString()}`}
                    {inv.paidDate && ` · Paid ${new Date(inv.paidDate).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={STATUS_COLORS[inv.status]}>
                    {inv.status}
                  </Badge>
                  {inv.status === "sent" && (
                    <Button
                      size="sm"
                      onClick={() => handlePay(inv.id)}
                      disabled={createCheckout.isPending}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Pay Now
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
