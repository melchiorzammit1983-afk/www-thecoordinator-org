import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCompany } from "@/lib/coordinator.functions";

export type Company = {
  id: string;
  name: string;
  status: string;
  isAdmin: boolean;
  operations_phone?: string | null;
} | null;

export function useMyCompany() {
  const fn = useServerFn(getMyCompany);
  return useQuery({
    queryKey: ["my-company"],
    queryFn: () => fn() as Promise<Company>,
    staleTime: 5 * 60_000,
  });
}
