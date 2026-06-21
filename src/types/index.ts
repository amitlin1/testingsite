export type ItemRow = {
  item_id: number;
  serial_no: string | null;
  item_type_id: number | null;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  customer_code: string | null;
  makat: number | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  model: string | null;
  total_steps: number | null;
  parent_item_id: number | null;
  source_id: number | null;
  connected_items?: {
    item_id: number;
    serial_no: string | null;
    item_type_desc: string | null;
    current_status: number | null;
    item_status_desc: string | null;
  }[];
  shipment_id: number | null;
  shipment_code: string | null;
};
export type NewItem = {
  customer: number | null
  itemType: number | null
  serialNumber?: string | null
  makat?: number | null
  model?: string | null
  manufacturer?: string | null
  manufacturerNo?: string | null
  shipment?: number | null
  routeNumber?: number | null
  subItems?: NewItem[]
}
export type ItemTypeOption = { item_type_id: number; item_type_desc: string };
export type Customers = { id: number; name: string; customer_code: string };
export type StatusOption = { id: number; label: string };

export type Shipment = {
  id: number;
  shipment_code: string;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  shipment_date: string;
  makat: number | null; // Legacy
  amount: number;
  total_items: number;
  in_work_items: number;
  valid_items: number;
  recieving_worker_id: number | null;
  recieving_worker_name: string | null;
  item_type_id: number | null; // Legacy
  item_type_desc: string | null; // Legacy
  signature_path?: string | null;
  shipment_items?: { item_type_id: number; quantity: number; item_type_desc?: string; makat?: number | null }[];
  source_id: number | null;
  source_desc: string | null;
  sending_worker_id: number | null;
  sending_worker_name: string | null;
  shipment_sent_date: string | null;
  is_sent?: boolean;
  finished_at?: string | null;
  sampled_amount?: number;
  valid_amount?: number;
  sub_items_sampled_amount?: number;
  poc_details?: string | null;
};

export type NewShipment = {
  shipment_code: string;
  customer_id: number | null;
  shipment_date: Date | null;
  makat: number | null; // Legacy main makat
  amount: number | null;
  recieving_worker_id?: number | null;
  item_type_id?: number | null;
  shipment_items?: { item_type_id: number; quantity: number; makat?: number | null }[];
  source_id?: number | null;
  sending_worker_id: number | null;
  poc_details?: string | null;
};

export type TestStation = {
  test_station_id: number;
  test_station_desc: string;
  test_station_type_id: number;
  status: number;
  is_research: boolean;
};

export type TestStationStatus = {
  test_station_status_id: number;
  test_station_status_desc: string;
};

export type Worker = {
  worker_id: number;
  worker_name: string;
  stokekeeper?: boolean;
};
