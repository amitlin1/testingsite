export type ItemRow = {
  item_id: number;
  serial_no: string | null;
  item_type_id: number | null;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  processing_start_time: string | null;
  queue_start_time: string | null;
  route_steps: number[] | null;
  route_number: number | null;
  has_children: boolean | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  customer_code: string | null;
  makat: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  model: string | null;
  total_steps: number | null;
  parent_item_id: number | null;
  /** Serial of the parent item — only set for accessory items. */
  parent_serial_no?: string | null;
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
  makat?: string | null
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
  makat: string | null; // Legacy
  amount: number;
  total_items: number;
  in_work_items: number;
  valid_items: number;
  recieving_worker_id: number | null;
  recieving_worker_name: string | null;
  item_type_id: number | null; // Legacy
  item_type_desc: string | null; // Legacy
  signature_path?: string | null;
  shipment_items?: { item_type_id: number; quantity: number; item_type_desc?: string; makat?: string | null }[];
  source_id: number | null;
  source_desc: string | null;
  sending_worker_id: number | null;
  sending_worker_name: string | null;
  shipment_sent_date: string | null;
  is_sent?: boolean;
  finished_at?: string | null;
  sampled_amount?: number;
  valid_amount?: number;
  finished_sampled_amount?: number;
  started_sampled_amount?: number;
  sub_items_sampled_amount?: number;
  poc_details?: string | null;
};

export type NewShipment = {
  shipment_code: string;
  customer_id: number | null;
  shipment_date: Date | null;
  makat: string | null; // Legacy main makat
  amount: number | null;
  recieving_worker_id?: number | null;
  recieving_worker_name?: string | null;
  item_type_id?: number | null;
  shipment_items?: { item_type_id: number; quantity: number; makat?: string | null }[];
  source_id?: number | null;
  sending_worker_id: number | null;
  sending_worker_name?: string | null;
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

/** Payload a test/finish dialog reports back to the page on submit. */
export type TestResultData = {
  Result: number;
  Comments?: string;
  WorkerID?: number;
  sendToResearch?: boolean;
  returnToRoute?: boolean; // החזר למסלול (5→2)
  finishRoute?: boolean; // סיים מסלול (5→3)
  SentAt?: string;
  ReturnAt?: string;
  Passed?: boolean; // overall pass/fail (station-type dialogs like the intake wizard)
  Details?: unknown; // station-type-specific structured payload → test_results.details
  // Client action UUID (§4.4). Dialogs that keep an error-retry path set it
  // themselves (same id on retry ⇒ ledger replay, not a duplicate event);
  // the page fills one in per call when a dialog doesn't.
  SubmitID?: string;
};

export interface StationTestDialogProps {
  open: boolean;
  onClose: () => void;
  item: ItemRow;
  station: TestStation;
  workerId: number | null;
  workerName: string;
  /** Called with the test result — the page persists it and drives the follow-up dialogs. */
  onSubmit: (data: TestResultData) => Promise<void>;
}
export interface TestStationType {
  id: number;
  name: string;
}

/** Lightweight station used by the testing dock's all-stations picker (from /api/stations). */
export type StationLite = { id: number; name: string; typeId: number };
