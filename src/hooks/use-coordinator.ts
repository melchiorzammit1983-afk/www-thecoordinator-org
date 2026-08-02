import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCompany } from "@/lib/coordinator.functions";

export type Company = {
  id: string;
  name: string;
  status: string;
  operations_phone: string | null;
  default_departure_pickup_offset_minutes: number;
  default_arrival_pickup_offset_minutes: number;
  isAdmin: boolean;
} | null;

export function useMyCompany() {
  const fn = useServerFn(getMyCompany);
  return useQuery({
    queryKey: ["my-company"],
    queryFn: () => fn() as Promise<Company>,
    staleTime: 5 * 60_000,
  });
}
